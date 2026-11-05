# Data packages

`load-data.sh` puts a data package (a `pg_dump -Fc` file of a Mezon database, e.g. the Linko data) into the
database of a Docker Compose deployment of this app, in place of its current data. On the server, from the project
folder (the one with `docker-compose.yml` and `.env`):

```sh
sh scripts/migrate/load-data.sh /path/to/linko-data.dump
```

It backs the current database up to `backups/backup-<time>.dump` first (load that file the same way to go back),
keeps the server's sign-in accounts (`users`) and settings (`app_settings`), stops the app, recreates the database
from the package, puts the kept accounts back (without their employee link and access right: set them again in
Права доступа → Пользователи) and starts the app, which brings the tables up to date by itself.

`TARGET_DB=<name>` loads into another database of the same server instead, for a trial run.

Packages and backups hold business data: they never go into this repository (`backups/` and `*.dump` are ignored).
