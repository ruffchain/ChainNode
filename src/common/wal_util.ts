import * as fs from 'fs-extra';

export function remove_db_files(dbPath: string) {
    let toRemove = [
        dbPath
    //    `${dbPath}-wal`,
    //    `${dbPath}-shm`
    ]
    toRemove.forEach((item) => {
        if (fs.existsSync(item)) {
            fs.unlinkSync(item);
        }
    });
}

export function copyDBFileSync(src: string, dest: string) {
    fs.copyFileSync(src, dest);
    //if (fs.existsSync(`${src}-wal`)) {
    //    //fs.copyFileSync(`${src}-wal`, `${dest}-wal`);
    //}
}
