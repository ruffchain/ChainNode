node ./dist/src/client/host/host.js peer ^
--consensus dpos ^
--handler "./dist/demo/dpos/contract/handler.js" ^
--genesis "./demo/dpos/genesis" ^
--coinbase 1Je1wpeMJKCUQ7HMc7rk7HpnihumgcmyNg ^
--dataDir "./data/dpos/peer1" ^
--net bdt --host 0.0.0.0 --port 13000 --sn SN_PEER_TEST@106.75.173.166@12999@12998 ^
--rpchost localhost --rpcport 18089 %*