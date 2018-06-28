node ./dist/src/client/host/host.js miner ^
--consensus dpos ^
--handler "./dist/demo/dpos/contract/handler.js" ^
--genesis "./demo/dpos/genesis" ^
--minerSecret c07ad83d2c5627acece18312362271e22d7aeffb6e2a6e0ffe1107371514fdc2 ^
--dataDir "./data/dpos/miner2" ^
--net bdt --host 0.0.0.0 --port 13001 --sn SN_PEER_TEST@106.75.173.166@12999@12998 %*