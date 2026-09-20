#!/bin/sh
set -eu

if [ ! -f /app/storage/projects.json ]; then
  cp -R /app/storage-default/. /app/storage/
fi

exec node src/server.js
