const gulp = require("gulp");
const ts = require("gulp-typescript");
const sourcemaps = require("gulp-sourcemaps");
const tsProject = ts.createProject("tsconfig.json");
const fs = require("fs-extra");
const shell = require('gulp-shell');

gulp.task("compile", function () {
    return tsProject.src()
        .pipe(sourcemaps.init())
        .pipe(tsProject())
        .js
        .pipe(sourcemaps.write())
        .pipe(gulp.dest("dist/blockchain-sdk"))
        .pipe(gulp.dest("dist/blockchain-sdk-cli"));
});

// 其他需要拷贝到dist目录的非代码文件,可以在这里加,调用npm run build会拷贝到dist
gulp.task("res", () => {
    [
        gulp.src(["./src/**/*.sql", "./src/**/*.js", "./src/**/*.d.ts", "./src/**/*.json"])
            .pipe(gulp.dest("./dist/blockchain-sdk/src")),
        gulp.src(["./test/**/*.sql", "./test/**/*.js", "./test/**/*.d.ts", "./test/**/*.json"])
            .pipe(gulp.dest("./dist/blockchain-sdk/src")),
        gulp.src(["./ruff/**/*.json"])
            .pipe(gulp.dest("./dist/blockchain-sdk/ruff")),
    ];
});

gulp.task("build", ["compile", "res"]);

gulp.task("_publish", () => {
    let pkg = fs.readJSONSync("./package.json");
    pkg.repository.url = "https://github.com/buckyos/chainsdk.git";
    pkg.main = "./src/client/index.js";
    pkg.types = "./src/client/index.d.ts";
    delete pkg.scripts;
    fs.ensureDirSync("./dist/blockchain-sdk/src/");
    fs.writeJSONSync("./dist/blockchain-sdk/package.json", pkg, {
        spaces: 4,
        flag: "w"
    });
});

gulp.task("prepareCli", () => {
    let pkg = fs.readJSONSync("./package.json");
    pkg.name = "blockchain-sdk-cli";
    pkg.repository.url = "https://github.com/buckyos/chainsdk.git";
    delete pkg.scripts;
    pkg.bin = {
        "chain_host": "./src/tool/host.js",
        "address_tool": "./src/tool/address.js",
        "chain_debuger": "./src/tool/debuger.js",
    };
    fs.ensureDirSync("./dist/blockchain-sdk-cli");
    fs.writeJSONSync("./dist/blockchain-sdk-cli/package.json", pkg, {
        spaces: 4,
        flag: "w"
    });
});

let imageName = process.env.CHAINNODE_DOCKER_IMAGENAME;

gulp.task("publish", ["build", "_publish", "prepareCli"]);

const genGenisisCmd = [
    "rm -fr distDocker",
    "./ruff/dposbft/create.sh >/dev/null 2>&1 || true",
    "mkdir -p distDocker/chainsdk",
    "cp Dockerfile distDocker",
    "cp -R ruff distDocker"
    "cp -a src distDocker/chainsdk/",
    "cp scripts/* distDocker/chainsdk",
    "cp package.json distDocker/chainsdk && cp tsconfig.json distDocker/chainsdk && cp tslint.json distDocker/chainsdk && cp gulpfile.js distDocker/chainsdk",
    `cd distDocker && docker build -t ${imageName} . && docker push ${imageName}`
];

gulp.task("build-docker", ["build"], shell.task(genGenisisCmd));
