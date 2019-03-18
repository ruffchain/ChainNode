# Update

New functions added @2019

## 1 Log rotate
  
Old logger, common/lib/logger_util.ts

```

initLogger(options: LoggerOptions)

export type LoggerOptions = {
    logger?: LoggerInstance;
    loggerOptions?: {console: boolean, file?: {root: string, filename?: string}, level?: string};
};

LogShim encapsulate Logger


```

Use winstondailyrotatefile

## 2 getLastIrreversibleBlockNumber

Add this API to get latest IRB number


