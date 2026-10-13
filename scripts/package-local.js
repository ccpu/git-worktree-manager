'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Package a separate local identity without modifying the repository manifest.
module.exports = async function packageLocal(repoRoot, vsixPath, publisher) {
    const { createVSIX, listFiles, PackageManager } = require('@vscode/vsce');
    const files = await listFiles({ cwd: repoRoot, packageManager: PackageManager.None });
    const tempRoot = path.resolve(os.tmpdir());
    const stagingRoot = fs.mkdtempSync(path.join(tempRoot, 'git-worktree-manager-local-'));
    if (
        path.dirname(stagingRoot) !== tempRoot ||
        !path.basename(stagingRoot).startsWith('git-worktree-manager-local-')
    ) {
        throw new Error(`Unexpected staging directory: ${stagingRoot}`);
    }
    try {
        for (const file of files) {
            const destination = path.join(stagingRoot, file);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(path.join(repoRoot, file), destination);
        }
        const ignoreFile = path.join(repoRoot, '.vscodeignore');
        if (fs.existsSync(ignoreFile)) {
            fs.copyFileSync(ignoreFile, path.join(stagingRoot, '.vscodeignore'));
        }
        const manifestPath = path.join(stagingRoot, 'package.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.publisher = publisher;
        manifest.displayName = `${manifest.displayName} (Local)`;
        // The installer builds before staging; --skip-build must not trigger prepublish.
        delete manifest.scripts?.['vscode:prepublish'];
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        await createVSIX({ cwd: stagingRoot, packagePath: vsixPath, dependencies: false });
    } finally {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
};
