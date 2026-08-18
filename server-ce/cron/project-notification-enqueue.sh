#!/usr/bin/env bash

set -eu

echo "-----------------------------------------------"
echo "Enqueueing project change notifications"
echo "(scan redis -> project-notification queue)"
echo "-----------------------------------------------"
date

source /etc/overleaf/env.sh

# Runs the upstream enqueue script (document-updater/scripts/project_notifications.mts)
# via the module-owned launcher which transpiles it with esbuild.
cd /overleaf/services/web && /sbin/setuser www-data node scripts/run_project_notifications.mjs

echo "Done."
