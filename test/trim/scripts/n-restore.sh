#!/bin/bash

IMAGE_NAME=reg.ruffcorp.com/rfc:1.16.2

HEIGHT=100
NODE_DIR="./data/dposbft/miner1/"
OUTPUT_DIR="./data/dposbft"
CONTAINER_NAME=ruffchain_restore

docker run --name ${CONTAINER_NAME} -v $(pwd)/data:/home/ruff/chainsdk/data -v $(pwd)/config/internal:/home/ruff/chainsdk/config ${IMAGE_NAME} /home/ruff/chainsdk/restore_storage.sh restore --dataDir ${NODE_DIR} --cfgFile ./config/tcpminer1.cfg --height ${HEIGHT} --output ${OUTPUT_DIR}

# wait for container to exit, if it exits, delete it.
echo -e '\nEnd\n'
