node ./dist/src/client/host/host.js miner ^
--consensus dpos ^
--handler "./dist/demo/dpos/contract/handler.js" ^
--genesis "./demo/dpos/genesis" ^
--minerSecret 64d8284297f40dc7475b4e53eb72bc052b41bef62fecbd3d12c5e99b623cfc11 ^
--dataDir "./data/dpos/miner1" ^
--net tcp --host localhost --port 13000 %*

timeout /t 2 /nobreak > NUL

node ./dist/src/client/host/host.js miner ^
--consensus dpos ^
--handler "./dist/demo/dpos/contract/handler.js" ^
--genesis "./demo/dpos/genesis" ^
--minerSecret c07ad83d2c5627acece18312362271e22d7aeffb6e2a6e0ffe1107371514fdc2 ^
--dataDir "./data/dpos/miner2" ^
--net tcp --host localhost --port 13000 --peers localhost:13000 %*