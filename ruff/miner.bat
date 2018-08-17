node ./dist/blockchain-sdk/src/tool/host.js miner ^
--genesis "./data/ruff/genesis" ^
--dataDir "./data/ruff/miner1" ^
--loggerConsole --loggerLevel debug ^
--minerSecret 64d8284297f40dc7475b4e53eb72bc052b41bef62fecbd3d12c5e99b623cfc11 ^
--net bdt --host 0.0.0.0 --port "0|13000" --peerid miner1 --sn SN_PEER_TEST@106.75.173.166@12999@12998 --bdt_log_level info %* 
