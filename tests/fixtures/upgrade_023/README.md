# Synthetic 0.23 upgrade fixture

`pending.json` was generated using the actual source at v0.23.0-alpha.1,
`bb2c9a6a1bcc5234750bb87dfcfee2dfa2cae45f`. Every person, credential, identity and station is fake.
It is not a backup from the owner. Generate with:

```
python tests/fixtures/upgrade_023/generate.py /path/to/0.23-checkout /path/to/output.json
```

The checkout must include its original tests, which provide the stateful device stub. The script
asserts that it imported the baseline's repository and that its manifest is 0.23. UUIDs and audit
timestamps change on regeneration. Keep the checked-in snapshot frozen for cross-version tests.

Station A has applied a PIN change/card removal and confirmed deletion of a second person.
Station B retains old credentials and an unconfirmed deletion, marked syncing at interruption.
An unassigned person was disabled through bulk review/apply, producing a receipt and audit.
Both stations also contain an unmanaged person who must remain untouched.
