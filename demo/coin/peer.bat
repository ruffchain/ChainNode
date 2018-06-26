node ./dist/src/client/host/host.js peer ^
--consensus pow ^
--handler "./dist/demo/coin/contract/handler.js" ^
--genesis "./demo/coin/genesis" ^
--coinbase 1Je1wpeMJKCUQ7HMc7rk7HpnihumgcmyNg ^
--dataDir "./data/coin/peer" ^
--net tcp --host localhost --port 12313 --peers "localhost:12312"