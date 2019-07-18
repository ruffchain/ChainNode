wrk.method = "POST"
-- json string
wrk.body = '{ "funName": "getBlocks" }'
-- 设置content-type
wrk.headers["Content-Type"] = "application/json"
