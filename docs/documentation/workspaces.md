# Managed workspace execution

Workspace commands require explicit authorization: run `outfitter login --workspaces`
and approve the workspace permission in your browser. Existing inference-only sessions
retain their original permissions. `OUTFITTER_USER_HOME` selects the isolated application
home used for credentials, refresh and revocation.

Commands emit JSON and return nonzero on failure:

```
outfitter workspaces capabilities
outfitter workspaces create <uuid>
outfitter workspaces inspect <uuid>
outfitter workspaces session-status <uuid>
outfitter workspaces session-transcript <uuid>
outfitter workspaces sleep <uuid>
outfitter workspaces wake <uuid>
outfitter workspaces close <uuid>
outfitter workspaces expire <uuid>
```

`session <uuid>` reads a session operation as JSON from stdin. Panopticon owns binding,
startup, repository provisioning and input delivery. `connect` maintains the outbound
callback bridge with `--installation <uuid> --service-url http://127.0.0.1:8000
--task-token-file <private-file>`. `attach` takes the workspace and installation IDs
and connects the terminal to its managed session. Healthy sleeping sessions wake and
resume; interrupted sessions require explicit recovery. Detaching preserves execution.

Only the configured loopback service can receive callbacks. The bridge substitutes the
scoped task capability for authorization and never sends user refresh tokens to task
containers. Reconnection obtains a new short-lived ticket and does not replay mutations
or terminal input whose outcome is unknown. `close` retains storage for 24 hours;
`expire` explicitly releases the workspace immediately.

Remote Panopticon support is optional and requires a compatible gateway/runtime. The
agent-side launch remains `outfitter run panopticon --harness pi -- ...`; harness selection
is independent of the execution location.
