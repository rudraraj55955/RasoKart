---
name: VPS SSH key format
description: Which VPS_SSH_KEY* secret is usable for actual SSH connections and how to decode it
---

The workspace has three VPS key secrets but only one decodes to a valid OpenSSH key:

- `VPS_SSH_KEY` — raw key all on one line with embedded spaces; `ssh-keygen -l` fails with "error in libcrypto"
- `VPS_SSH_KEY_B64` — `base64 -d` fails with "invalid input"
- `VPS_SSH_KEY_B64URL` — URL-safe base64; decode with `tr '_-' '/+' | base64 -d` → valid ED25519 key (256 SHA256:…)

**How to apply:**
```bash
echo "$VPS_SSH_KEY_B64URL" | tr '_-' '/+' | base64 -d > /tmp/id_rsa && chmod 600 /tmp/id_rsa
ssh -i /tmp/id_rsa -o StrictHostKeyChecking=no -o BatchMode=yes root@$VPS_HOST "hostname"
```

**Why:** The raw secret value has whitespace/encoding issues introduced when it was saved. The B64URL variant is the canonical portable form. Validate with `ssh-keygen -l -f /tmp/id_rsa` before attempting connection.
