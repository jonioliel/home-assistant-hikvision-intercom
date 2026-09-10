"""Global camera settings persist atomically, reject ambiguity and survive reload."""

from copy import deepcopy
from unittest.mock import AsyncMock, Mock

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.media_settings import DEFAULTS, MediaSettings, normalize


async def test_persist_reload_conflict_and_noop():
    save, changed = AsyncMock(), Mock()
    store = MediaSettings(save, changed)
    assert store.public() == {"revision": 0, **DEFAULTS}
    values = {**DEFAULTS, "webrtc_mode": "mse", "go2rtc_url": "http://go2rtc:1984/"}
    result = await store.update(0, values)
    assert result["revision"] == 1 and result["go2rtc_url"] == "http://go2rtc:1984"
    copy = MediaSettings(AsyncMock(), Mock())
    copy.load(deepcopy(save.call_args.args[0]))
    assert copy.public() == result
    await store.update(1, values)
    save.assert_awaited_once()
    changed.assert_called_once()
    with pytest.raises(AccessError, match="revision_conflict"):
        await store.update(0, {**DEFAULTS, "transport": "hls"})
    assert store.public() == result


async def test_failed_disk_write_does_not_publish():
    save, changed = AsyncMock(side_effect=OSError), Mock()
    store = MediaSettings(save, changed)
    with pytest.raises(OSError):
        await store.update(0, {**DEFAULTS, "transport": "hls"})
    assert store.public() == {"revision": 0, **DEFAULTS}
    changed.assert_not_called()


@pytest.mark.parametrize(
    "value",
    [
        "rtsp://host",
        "http://a:p@host",
        "http://host/api",
        "http://host?key=value",
        "http://host#fragment",
        "http://host:0",
        "http://host:bad",
        "http://bad host",
        "http://host\\foo",
        "http://host\n",
        "http://[invalid",
    ],
)
def test_reject_invalid_server(value):
    with pytest.raises(AccessError, match="invalid_fields"):
        normalize({**DEFAULTS, "go2rtc_url": value})


@pytest.mark.parametrize(
    "data",
    [
        {},
        [],
        {"schema": 2, "revision": 0, "values": DEFAULTS},
        {"schema": 1, "revision": True, "values": DEFAULTS},
        {"schema": 1, "revision": 0, "values": {}},
    ],
)
def test_corrupt_settings_not_silently_reset(data):
    with pytest.raises(AccessError, match="invalid_storage"):
        MediaSettings(AsyncMock(), Mock()).load(data)


@pytest.mark.parametrize(
    "values",
    [
        {**DEFAULTS, "transport": "auto"},
        {**DEFAULTS, "webrtc_mode": "hls"},
        {**DEFAULTS, "fallback_hls": 1},
        {**DEFAULTS, "extra": True},
    ],
)
def test_exact_options(values):
    with pytest.raises(AccessError):
        normalize(values)
