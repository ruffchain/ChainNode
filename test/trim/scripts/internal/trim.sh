#!/bin/bash

IMAGE_NAME=reg.ruffcorp.com/rfc:1.16.2

HEIGHT=100
NODE_DIR="./data/dposbft/miner1/"
OUTPUT_DIR="./data/dposbft"
CONTAINER_NAME=ruffchain_restore

node ./dist/

# wait for container to exit, if it exits, delete it.
echo -e '\nEnd\n'
