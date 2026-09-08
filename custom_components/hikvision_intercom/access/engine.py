"""Reconcile explicit ownership with durable intent and readback after every write."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass
from functools import partial

from ..client.access import AccessClient, StationInventory
from ..exceptions import (
    HikvisionAuthError,
    HikvisionBusyError,
    HikvisionCapacityError,
    HikvisionConflictError,
    HikvisionConnectionError,
    HikvisionDeviceError,
    HikvisionError,
    HikvisionTimeoutError,
    HikvisionUnsupportedError,
)
from .models import AccessError, ManagedUser
from .normalize import canonical, desired_cards, desired_person, merge_person
from .repository import AccessRepository


@dataclass(slots=True)
class ReconcileResult:
    completed: int = 0
    failed: int = 0
    retry: bool = False
    offline: bool = False


class SyncEngine:
    def __init__(
        self,
        repository: AccessRepository,
        *,
        concurrency: int = 3,
        changed: Callable[[], None] | None = None,
    ) -> None:
        self.repository = repository
        self._slots = asyncio.Semaphore(concurrency)
        self._changed = changed or (lambda: None)

    def jobs(self, station: str) -> list[str]:
        state = self.repository.snapshot()
        users = {key for key, value in state["users"].items() if station in value["assignments"]}
        users |= set(state["bindings"].get(station, {}))
        users |= {
            item["user_id"]
            for item in state["retired_cards"].values()
            if station in item["targets"] and station not in item["confirmed"]
        }
        tombstones = {
            key
            for key, value in state["tombstones"].items()
            if station in value["targets"] and station not in value["confirmed"]
        }
        return sorted(tombstones) + sorted(users - tombstones)

    async def async_reconcile(self, station: str, driver: AccessClient) -> ReconcileResult:
        result = ReconcileResult()
        async with self._slots, driver.transaction():
            if driver.capabilities is None:
                await driver.async_capabilities()
            inventory = await driver.async_inventory()
            for user_id in self.jobs(station):
                try:
                    await self.repository.async_mark(station, user_id, "syncing")
                    self._changed()
                    await self._person(station, user_id, driver, inventory)
                except AccessError as err:
                    if err.code == "revision_conflict":
                        result.retry = True
                        await self.repository.async_mark(station, user_id, "pending")
                    else:
                        result.failed += 1
                        await self.repository.async_mark(
                            station,
                            user_id,
                            "conflict"
                            if err.code
                            in {
                                "unmanaged_employee",
                                "device_changed",
                                "card_owned_elsewhere",
                                "pin_owned_elsewhere",
                                "ambiguous_write",
                            }
                            else "error",
                            err.code,
                        )
                except (HikvisionConnectionError, HikvisionTimeoutError):
                    result.failed += 1
                    result.retry = result.offline = True
                    await self.repository.async_mark(
                        station, user_id, "offline", "connection_failed"
                    )
                    break
                except HikvisionBusyError:
                    result.failed += 1
                    result.retry = True
                    await self.repository.async_mark(station, user_id, "pending", "device_busy")
                    break
                except HikvisionConflictError:
                    result.failed += 1
                    await self.repository.async_mark(
                        station, user_id, "conflict", "device_conflict"
                    )
                except HikvisionCapacityError:
                    result.failed += 1
                    await self.repository.async_mark(
                        station, user_id, "error", "capacity_exhausted"
                    )
                except HikvisionAuthError:
                    result.failed += 1
                    await self.repository.async_mark(
                        station, user_id, "error", "authentication_failed"
                    )
                    raise
                except HikvisionUnsupportedError:
                    result.failed += 1
                    await self.repository.async_mark(
                        station, user_id, "error", "operation_unsupported"
                    )
                except HikvisionError:
                    result.failed += 1
                    await self.repository.async_mark(station, user_id, "error", "device_rejected")
                else:
                    result.completed += 1
                finally:
                    self._changed()
        return result

    async def _person(
        self, station: str, user_id: str, driver: AccessClient, inventory: StationInventory
    ) -> None:
        caps = driver.capabilities
        assert caps is not None
        state = self.repository.snapshot()
        raw = state["users"].get(user_id)
        tombstone = state["tombstones"].get(user_id)
        if raw is None and tombstone is None:
            return
        user = ManagedUser.from_private(raw if raw is not None else tombstone["record"])
        assignment = user.assignments.get(station) if raw is not None else None
        present = bool(raw is not None and user.active and assignment and assignment.enabled)
        if not driver.client.enabled_doors:
            raise AccessError("station_has_no_managed_lock")
        if assignment and (
            assignment.allowed_locks != frozenset({1}) or assignment.schedule_template is not None
        ):
            raise AccessError("unmanaged_lock")
        binding = state["bindings"].get(station, {}).get(user_id)
        # Refresh this person under the station transaction, including all of their cards.
        current = await driver.async_person(user.employee_no)
        merge_person(inventory, user.employee_no, current)
        current_fingerprint = self.repository.fingerprint(
            canonical(current, user.employee_no, caps)
        )
        if binding is None:
            if current.users:
                raise AccessError("unmanaged_employee")
            if not present:
                await self.repository.async_confirm_absent(station, user_id, revision=user.revision)
                return
        elif binding["employee_no"] != user.employee_no:
            raise AccessError("device_changed")
        elif not current.users and not present:
            await self.repository.async_confirm_absent(station, user_id, revision=user.revision)
            return
        elif current_fingerprint != binding["fingerprint"]:
            intent = binding.get("intent")
            if intent and current_fingerprint in {
                intent["desired_fingerprint"],
                intent.get("before_fingerprint"),
            }:
                # The previous response was lost, but exact readback proves its configuration.
                await self.repository.async_record_observation(
                    station, user_id, fingerprint=current_fingerprint, applied_revision=None
                )
            else:
                raise AccessError("ambiguous_write" if intent else "device_changed")
        elif binding.get("intent"):
            # The state still matches the journal's before-image; clear that completed read phase.
            await self.repository.async_record_observation(
                station, user_id, fingerprint=current_fingerprint, applied_revision=None
            )

        if not present:
            await self._remove(station, user, driver, inventory, current)
            return
        api_id = next(iter(driver.client.enabled_doors))
        person = desired_person(user, api_id, caps)
        cards = desired_cards(user, caps)
        if not current.users and len(inventory.users) >= caps.max_users:
            raise AccessError("person_capacity")
        if len(inventory.cards) - len(current.cards) + len(cards) > caps.max_cards:
            raise AccessError("card_capacity")
        for number in cards:
            existing = inventory.cards.get(number)
            if existing and existing["employeeNo"] != user.employee_no:
                raise AccessError("card_owned_elsewhere")
        if user.pin and caps.pin_field:
            if any(
                other.get(caps.pin_field) == user.pin.value
                for number, other in inventory.users.items()
                if number != user.employee_no
            ):
                raise AccessError("pin_owned_elsewhere")
        if current.users and current.users[user.employee_no].get("RightPlan") != []:
            raise AccessError("schedule_unverified")

        desired = StationInventory({user.employee_no: person}, cards)
        desired_normal = canonical(desired, user.employee_no, caps)
        actual_normal = canonical(current, user.employee_no, caps)
        if desired_normal["person"] != actual_normal["person"]:
            expected = deepcopy(current)
            create = not bool(current.users)
            expected.users[user.employee_no] = {**current.users.get(user.employee_no, {}), **person}
            payload = deepcopy(person)
            if create and caps.pin_field and payload.get(caps.pin_field) == "":
                payload.pop(caps.pin_field)
            current = await self._step(
                station,
                user,
                driver,
                inventory,
                current,
                expected,
                "create" if create else "update",
                lambda: driver.async_write_person(payload, create=create),
            )
        # Remove obsolete cards before adding new ones, so replacement works at capacity.
        for number in list(current.cards):
            if number not in cards:
                expected = deepcopy(current)
                del expected.cards[number]
                current = await self._step(
                    station,
                    user,
                    driver,
                    inventory,
                    current,
                    expected,
                    "update",
                    partial(driver.async_delete_card, number),
                )
        for number, card in cards.items():
            existing = current.cards.get(number)
            if existing is not None and existing.get("cardType") == card["cardType"]:
                continue
            expected = deepcopy(current)
            expected.cards[number] = card
            current = await self._step(
                station,
                user,
                driver,
                inventory,
                current,
                expected,
                "update",
                partial(
                    driver.async_write_card,
                    user.employee_no,
                    number,
                    card["cardType"],
                    create=existing is None,
                ),
            )
        if canonical(current, user.employee_no, caps) != desired_normal:
            raise AccessError("readback_mismatch")
        # A new centrally created user with no credential changes still needs an ownership binding.
        await self.repository.async_record_observation(
            station,
            user.id,
            fingerprint=self.repository.fingerprint(desired_normal),
            applied_revision=user.revision,
        )
        await self.repository.async_confirm_card_removals(station, user.id, set(current.cards))

    async def _step(
        self,
        station: str,
        user: ManagedUser,
        driver: AccessClient,
        inventory: StationInventory,
        before: StationInventory,
        expected: StationInventory,
        operation: str,
        write: Callable[[], Awaitable[None]],
    ) -> StationInventory:
        caps = driver.capabilities
        assert caps is not None
        before_hash = self.repository.fingerprint(canonical(before, user.employee_no, caps))
        expected_hash = self.repository.fingerprint(canonical(expected, user.employee_no, caps))
        binding = self.repository.snapshot()["bindings"].get(station, {}).get(user.id)
        if binding is not None and before_hash != binding["fingerprint"]:
            raise AccessError("device_changed")
        await self.repository.async_write_intent(
            station,
            user.id,
            revision=user.revision,
            expected_fingerprint=binding["fingerprint"] if binding else None,
            desired_fingerprint=expected_hash,
            operation=operation,
            before_fingerprint=before_hash,
        )
        await write()
        for attempt in range(4):
            after = await driver.async_person(user.employee_no)
            observed_hash = self.repository.fingerprint(canonical(after, user.employee_no, caps))
            if observed_hash == expected_hash:
                await self.repository.async_record_observation(
                    station, user.id, fingerprint=observed_hash, applied_revision=None
                )
                merge_person(inventory, user.employee_no, after)
                return after
            if observed_hash != before_hash:
                raise AccessError("readback_mismatch")
            if attempt < 3:
                await asyncio.sleep(0.25 * (attempt + 1))
        raise HikvisionDeviceError("Access write did not converge during readback")

    async def _remove(
        self,
        station: str,
        user: ManagedUser,
        driver: AccessClient,
        inventory: StationInventory,
        current: StationInventory,
    ) -> None:
        for number in list(current.cards):
            expected = deepcopy(current)
            del expected.cards[number]
            current = await self._step(
                station,
                user,
                driver,
                inventory,
                current,
                expected,
                "delete",
                partial(driver.async_delete_card, number),
            )
        if current.users:
            current = await self._step(
                station,
                user,
                driver,
                inventory,
                current,
                StationInventory(),
                "delete",
                lambda: driver.async_delete_person(user.employee_no),
            )
        if current.users or current.cards:
            raise AccessError("delete_not_verified")
        await self.repository.async_confirm_absent(station, user.id, revision=user.revision)
