node ./dist/blockchain-sdk/src/tool/host.js miner ^
--genesis "./data/ruff/genesis" ^
--dataDir "./data/ruff/peer" ^
--loggerConsole --loggerLevel debug ^
--net bdt --host 0.0.0.0 --port "13011|13001" --peerid peer1 --sn SN_PEER_TEST@106.75.173.166@12999@12998 ^
--rpchost localhost --rpcport 18089 %*