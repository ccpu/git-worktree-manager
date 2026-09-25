/* eslint-disable @typescript-eslint/naming-convention -- Node VM globals and module names use fixed keys. */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from '@rstest/core';

const root = process.cwd();
const script = readFileSync(path.join(root, 'scripts/install-local.js'), 'utf8');
const packageInfo = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    publisher: string;
    name: string;
    version: string;
};
const extensionId = `${packageInfo.publisher}.${packageInfo.name}`;

interface RunOptions {
    args?: string[];
    installedVersion?: string;
    modulesMissing?: boolean;
    failedCommand?: string;
}

function runInstaller(options: RunOptions = {}) {
    const commands: string[] = [];
    const removed: string[] = [];
    const errors: string[] = [];
    let exitCode: number | undefined;

    const spawnSync = (command: string) => {
        commands.push(command);
        if (options.failedCommand && command.includes(options.failedCommand)) return { status: 1, stdout: '' };
        if (command.includes('--list-extensions')) {
            return {
                status: 0,
                stdout: options.installedVersion ? `${extensionId}@${options.installedVersion}\n` : '',
            };
        }
        return { status: 0, stdout: '' };
    };
    const mockFs = {
        existsSync: (file: string) => !(options.modulesMissing && file.endsWith('node_modules')),
        readFileSync: () => JSON.stringify(packageInfo),
        rmSync: (file: string) => removed.push(file),
    };
    const modules = {
        child_process: { spawnSync },
        fs: mockFs,
        path,
    };
    runInNewContext(script, {
        __dirname: path.join(root, 'scripts'),
        require: (id: keyof typeof modules) => modules[id],
        process: {
            argv: ['node', 'install-local.js', ...(options.args ?? [])],
            env: {},
            platform: 'win32',
            exit: (code: number) => {
                exitCode = code;
            },
        },
        console: {
            log: () => undefined,
            error: (message: string) => errors.push(message),
        },
    });

    return { commands, removed, errors, exitCode };
}

describe('local VS Code installer', () => {
    it('builds, packages, and installs a new version, then removes the VSIX', () => {
        const result = runInstaller({ modulesMissing: true });

        expect(result.exitCode).toBeUndefined();
        expect(result.commands).toContain('pnpm install');
        expect(result.commands).toContain('pnpm run package');
        expect(result.commands.some((command) => command.includes('vsce package --no-dependencies --out'))).toBe(true);
        expect(
            result.commands.some((command) => command.includes('--install-extension') && command.includes('--force')),
        ).toBe(true);
        expect(result.removed).toHaveLength(1);
        expect(result.removed[0]).toContain(`${packageInfo.name}-${packageInfo.version}.vsix`);
    });

    it('refuses to reinstall the same version before building or packaging', () => {
        const result = runInstaller({ installedVersion: packageInfo.version });

        expect(result.exitCode).toBe(1);
        expect(result.errors[0]).toContain('already installed');
        expect(result.commands.some((command) => command.startsWith('pnpm '))).toBe(false);
    });

    it('replaces an older version and honors skip-build and keep-vsix', () => {
        const result = runInstaller({
            args: ['--skip-build', '--keep-vsix', '--code', 'code-insiders'],
            installedVersion: '0.0.1',
        });

        expect(result.exitCode).toBeUndefined();
        expect(result.commands).not.toContain('pnpm run package');
        expect(result.commands).toContain(`code-insiders --uninstall-extension ${extensionId}`);
        expect(result.commands.some((command) => command.startsWith('code-insiders --install-extension'))).toBe(true);
        expect(result.removed).toHaveLength(0);
    });

    it('stops before installation when packaging fails', () => {
        const result = runInstaller({ failedCommand: 'vsce package' });

        expect(result.exitCode).toBe(1);
        expect(result.commands.some((command) => command.includes('--install-extension'))).toBe(false);
        expect(result.removed).toHaveLength(0);
    });
});
