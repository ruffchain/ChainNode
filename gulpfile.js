const gulp = require('gulp');
const ts = require('gulp-typescript');
const tsProject = ts.createProject('tsconfig.json');

gulp.task('compile', function () {
    return tsProject.src()
        .pipe(tsProject())
        .js.pipe(gulp.dest('dist'));
});

// 其他需要拷贝到dist目录的非代码文件,可以在这里加,调用npm run build会拷贝到dist
gulp.task('res', () => {
    return gulp.src(['./src/**/*.sql', './src/**/*.js', './test/**/*.json'])
        .pipe(gulp.dest('./dist'));
});

gulp.task('build', ['compile', 'res']);
