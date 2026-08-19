#!/usr/bin/env bash

set -eu

echo "-----------------------------------------------"
echo "Enqueueing project change notifications"
echo "(scan redis -> project-notification queue)"
echo "-----------------------------------------------"
date

source /etc/container_environment.sh
source /etc/overleaf/env.sh

# Runs the upstream enqueue script directly: the image's node (>= 22.18) strips
# TS types natively, so no esbuild launcher is needed. /etc/container_environment.sh
# provides REDIS_HOST / CRYPTO_RANDOM / OVERLEAF_MONGO_URL for the standalone process.
cd /overleaf && /sbin/setuser www-data node services/document-updater/scripts/project_notifications.mts

echo "Done."
