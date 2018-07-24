node ./dist/src/client/tools/host.js miner ^
--consensus pow ^
--handler "./dist/demo/coin/contract/handler.js" ^
--genesis "./demo/coin/genesis" ^
--coinbase 12LKjfgQW26dQZMxcJdkj2iVP2rtJSzT88 ^
--dataDir "./data/coin/miner" ^
--net tcp --host localhost --port 12312 ^
--rpchost localhost --rpcport 18089