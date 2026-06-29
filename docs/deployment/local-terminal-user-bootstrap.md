# Local Terminal User Bootstrap

Use this procedure to create production LibreChat accounts from a local Mac
terminal while the production app runs on Render.

This is preferred over running `create-user` through Render SSH on the low-cost
Starter instance. The script opens a separate Node process, and the 512 MB
runtime can terminate the SSH session before the password prompt appears.

## Prerequisites

- Run commands from the repository root:

  ```bash
  cd /Users/neven/Documents/projects/LibreChat
  ```

- Local dependencies are installed.
- `.env.prod` exists locally and contains the production `MONGO_URI`.
- MongoDB Atlas Network Access allows your local public IP, or temporarily
  allows `0.0.0.0/0` during bootstrap.
- A local ignored `librechat.yaml` exists. If it does not, create the minimal
  file:

  ```bash
  printf 'version: 1.3.11\n' > librechat.yaml
  ```

Do not commit `.env.prod`, `librechat.yaml`, passwords, or generated secrets.

## Create The First Admin

For a clean production MongoDB with no existing users, the first created user
becomes `ADMIN`.

Run:

```bash
DOTENV_CONFIG_PATH=.env.prod CONFIG_PATH=librechat.yaml \
  node -r dotenv/config config/create-user.js \
  admin@example.com "Admin" admin --email-verified=true
```

Replace `admin@example.com` with the real admin email.

When prompted:

```text
Password: (leave blank, to generate one)
>
```

Enter the password manually, or press Enter to let LibreChat generate one.

Expected result:

```text
User created successfully!
Email verified: true
```

Do not pass the password as a command argument. The script supports that, but
it can leave the password in shell history or process listings.

## Create Internal Users

Create the remaining internal users with the same command shape:

```bash
DOTENV_CONFIG_PATH=.env.prod CONFIG_PATH=librechat.yaml \
  node -r dotenv/config config/create-user.js \
  user01@example.com "User 01" user01 --email-verified=true
```

Recommended username pattern for the first 10 internal accounts:

```text
admin
user01
user02
user03
user04
user05
user06
user07
user08
user09
```

After the first account, new accounts are normal users unless you promote them
through an admin path.

## Verify Login

After creating an account:

1. Open the Render production URL.
2. Sign in with the created email and password.
3. Confirm the user reaches LibreChat.

This does not require restarting Render because the account is written directly
to production MongoDB.

## Troubleshooting

`Config file YAML format is invalid: ENOENT ... /data/librechat.yaml`

- You ran the script with production `CONFIG_PATH=/data/librechat.yaml` from
  your local machine.
- Re-run with `CONFIG_PATH=librechat.yaml`.

`Please define the MONGO_URI environment variable`

- `.env.prod` was not loaded.
- Confirm the command includes `DOTENV_CONFIG_PATH=.env.prod` before
  `node -r dotenv/config`.

`Could not connect to any servers in your MongoDB Atlas cluster`

- MongoDB Atlas is blocking your local public IP.
- Add your current IP in Atlas Security > Network Access, or temporarily add
  `0.0.0.0/0` and remove it after bootstrap.

`Error: A user with that email or username already exists`

- The account already exists.
- Use a different email/username, or reset the existing user's password through
  a controlled admin procedure.

Render SSH closes before password prompt

- Do not keep retrying on the Starter instance.
- Run the local terminal command in this document instead.
