node ./dist/src/client/host/host.js miner ^
--consensus dpos ^
--handler "./dist/demo/dpos/contract/handler.js" ^
--genesis "./demo/dpos/genesis" ^
--minerSecret 64d8284297f40dc7475b4e53eb72bc052b41bef62fecbd3d12c5e99b623cfc11 ^
--dataDir "./data/dpos/miner1" ^
--net bdt --host 0.0.0.0 --port 13000 --sn SN_PEER_TEST@106.75.173.166@12999@12998 %*