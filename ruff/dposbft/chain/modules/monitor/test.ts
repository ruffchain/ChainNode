const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs-extra');

function bExactStandardHour(): boolean {
    let date = new Date();
    console.log(date.getMinutes())

    return true;
}

function getVersion() {
    let config = fs.readJSONSync('./package.json');
    if (config) {
        return config.version;
    } else {
        return null;
    }
}

async function main() {
    const { stdout, stderr } = await exec(`du -s ./data`);
    console.log(stdout);
    console.log(stderr);

    console.log(typeof stdout);
    console.log(stdout.length)
    console.log(stdout.split(''))
    console.log(stdout.split(' '))
    console.log(stdout.split('\t')[0])

    let strMatch = stdout.match(/^([0-9]+)/g);
    console.log(strMatch[0]);

    console.log('\n', bExactStandardHour());

    console.log('\n', getVersion());

}
main();


