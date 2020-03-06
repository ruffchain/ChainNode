#!/bin/bash

IMAGE_NAME=reg.ruffcorp.com/rfc:1.16.2

HEIGHT=100
NODE_DIR="./data/dposbft/miner1/"
OUTPUT_DIR="./data/dposbft"
CONTAINER_NAME=ruffchain_trim
# CMD=check
CMD=trim

docker run --name ${CONTAINER_NAME} --rm -v $(pwd)/data:/home/ruff/chainsdk/data -v $(pwd)/config/internal:/home/ruff/chainsdk/config ${IMAGE_NAME} /home/ruff/chainsdk/trim.sh ${CMD} --dataDir ${NODE_DIR} --cfgFile ./config/tcpminer1.cfg --height ${HEIGHT}

# wait for container to exit, if it exits, delete it.
echo -e '\nEnd\n'
