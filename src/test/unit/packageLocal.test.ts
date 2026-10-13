/* eslint-disable @typescript-eslint/naming-convention -- Node modules and VS Code manifest keys use fixed names. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from '@rstest/core';

const script = fs.readFileSync(path.join(process.cwd(), 'scripts/package-local.js'), 'utf8');

async function packageFixture(fail = false) {
    const tempRoot = path.resolve(os.tmpdir());
    const fixtureRoot = fs.mkdtempSync(path.join(tempRoot, 'git-worktree-manager-test-'));
    if (
        path.dirname(fixtureRoot) !== tempRoot ||
        !path.basename(fixtureRoot).startsWith('git-worktree-manager-test-')
    ) {
        throw new Error(`Unexpected fixture directory: ${fixtureRoot}`);
    }
    const original = JSON.stringify({
        publisher: 'upstream',
        name: 'extension',
        displayName: 'Extension',
        scripts: { 'vscode:prepublish': 'build' },
        contributes: { commands: [{ command: 'extension.run' }] },
    });
    let stagingRoot = '';
    let stagedManifest: Record<string, unknown> | undefined;
    const module = { exports: undefined as unknown };
    const modules = {
        fs,
        os,
        path,
        '@vscode/vsce': {
            PackageManager: { None: 2 },
            listFiles: async (options: { cwd: string; packageManager: number }) => {
                expect(options).toEqual({ cwd: fixtureRoot, packageManager: 2 });
                return ['package.json', 'dist/extension.js'];
            },
            createVSIX: async (options: { cwd: string; packagePath: string; dependencies: boolean }) => {
                stagingRoot = options.cwd;
                expect(options.packagePath).toBe(path.join(fixtureRoot, 'local.vsix'));
                expect(options.dependencies).toBe(false);
                expect(fs.readFileSync(path.join(stagingRoot, 'dist/extension.js'), 'utf8')).toBe('bundle');
                stagedManifest = JSON.parse(fs.readFileSync(path.join(stagingRoot, 'package.json'), 'utf8'));
                if (fail) throw new Error('Packaging failed');
            },
        },
    };
    try {
        fs.mkdirSync(path.join(fixtureRoot, 'dist'));
        fs.writeFileSync(path.join(fixtureRoot, 'package.json'), original);
        fs.writeFileSync(path.join(fixtureRoot, 'dist/extension.js'), 'bundle');
        runInNewContext(script, { module, require: (id: keyof typeof modules) => modules[id] });
        const packageLocal = module.exports as (root: string, output: string, publisher: string) => Promise<void>;
        const result = packageLocal(fixtureRoot, path.join(fixtureRoot, 'local.vsix'), 'upstream-local');
        if (fail) await expect(result).rejects.toThrow('Packaging failed');
        else await result;
        expect(fs.readFileSync(path.join(fixtureRoot, 'package.json'), 'utf8')).toBe(original);
        expect(fs.existsSync(stagingRoot)).toBe(false);
        return stagedManifest;
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

describe('local VSIX packaging', () => {
    it('packages a separate identity, preserves commands and leaves the source manifest intact', async () => {
        expect(await packageFixture()).toEqual({
            publisher: 'upstream-local',
            name: 'extension',
            displayName: 'Extension (Local)',
            scripts: {},
            contributes: { commands: [{ command: 'extension.run' }] },
        });
    });

    it('cleans staging and leaves the source manifest intact when packaging fails', async () => {
        await packageFixture(true);
    });
});
