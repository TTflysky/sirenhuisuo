# v0.64 Verified Chat Artifact Projection

Assistant and employee chat both receive structured evidence from native tool calls. The bridge now registers each reported artifact with TaskService before the task is completed.

Persisted task artifacts preserve the logical path shown to the user, real disk path, task workspace, byte size, content type, category and verification method. A `verified` artifact still requires native disk evidence; a response that merely claims a file was created does not qualify.
