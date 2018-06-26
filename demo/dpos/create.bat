node ./dist/src/client/host/host.js create ^
--consensus dpos ^
--handler "./dist/demo/dpos/contract/handler.js" ^
--dataDir "./demo/dpos/genesis" ^
--minerSecret 64d8284297f40dc7475b4e53eb72bc052b41bef62fecbd3d12c5e99b623cfc11 ^
--genesisFile "./demo/dpos/genesis.json" ^
--force