wrk.method = "POST"
-- json string
wrk.body = '{ "funName": "view", "args": "{" "method": "getCandidates", "params": "{" "}" "}" }'
-- 设置content-type
wrk.headers["Content-Type"] = "application/json"
