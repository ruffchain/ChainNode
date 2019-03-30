#!/bin/bash

node ./dist/blockchain-sdk/src/tool/host.js miner --genesis "./data/dposbft/genesis"   --dataDir "./data/dposbft/miner1" --loggerConsole --loggerLevel debug --minerSecret 054898c1a167977bc42790a3064821a2a35a8aa53455b9b3659fb2e9562010f7   --rpchost 127.0.0.1 --rpcport 18089 --minOutbound 0  --feelimit 100 --net bdt --host 127.0.0.1 --port "13101|13000" --peerid 1Bbruv7E4nP62ZD4cJqxiGrUD43psK5E2J --sn SN_PEER_TEST@45.62.98.174@10008@10009 --bdt_log_level info --txServer --minOutbound 0  --forceClean
