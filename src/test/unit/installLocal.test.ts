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
const localPublisher = `${packageInfo.publisher}-local`;
const localExtensionId = `${localPublisher}.${packageInfo.name}`;

interface RunOptions {
    args?: string[];
    installedVersion?: string;
    marketplaceVersion?: string;
    modulesMissing?: boolean;
    failedCommand?: string;
}

async function runInstaller(options: RunOptions = {}) {
    const commands: string[] = [];
    const removed: string[] = [];
    const errors: string[] = [];
    const packages: { repoRoot: string; vsixPath: string; publisher: string }[] = [];
    let exitCode: number | undefined;

    const spawnSync = (command: string) => {
        commands.push(command);
        if (options.failedCommand && command.includes(options.failedCommand)) return { status: 1, stdout: '' };
        if (command.includes('--list-extensions')) {
            return {
                status: 0,
                stdout: [
                    options.installedVersion ? `${localExtensionId}@${options.installedVersion}` : '',
                    options.marketplaceVersion ? `${extensionId}@${options.marketplaceVersion}` : '',
                ].join('\n'),
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
        './package-local': async (repoRoot: string, vsixPath: string, publisher: string) => {
            packages.push({ repoRoot, vsixPath, publisher });
            if (options.failedCommand === 'package') throw new Error('Packaging failed');
        },
    };
    await runInNewContext(script, {
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

    return { commands, removed, errors, packages, exitCode };
}

describe('local VS Code installer', () => {
    it('builds, packages, and installs a local identity, then removes the VSIX', async () => {
        const result = await runInstaller({ modulesMissing: true });

        expect(result.exitCode).toBeUndefined();
        expect(result.commands).toContain('pnpm install');
        expect(result.commands).toContain('pnpm run package');
        expect(result.packages).toEqual([
            {
                repoRoot: root,
                vsixPath: path.join(root, `${packageInfo.name}-local-${packageInfo.version}.vsix`),
                publisher: localPublisher,
            },
        ]);
        expect(
            result.commands.some((command) => command.includes('--install-extension') && command.includes('--force')),
        ).toBe(true);
        expect(result.removed).toHaveLength(1);
        expect(result.removed[0]).toContain(`${packageInfo.name}-local-${packageInfo.version}.vsix`);
    });

    it('refuses to reinstall the same local version before building or packaging', async () => {
        const result = await runInstaller({ installedVersion: packageInfo.version });

        expect(result.exitCode).toBe(1);
        expect(result.errors[0]).toContain('already installed');
        expect(result.commands.some((command) => command.startsWith('pnpm '))).toBe(false);
    });

    it('replaces an older local version and honors skip-build and keep-vsix', async () => {
        const result = await runInstaller({
            args: ['--skip-build', '--keep-vsix', '--code', 'code-insiders'],
            installedVersion: '0.0.1',
        });

        expect(result.exitCode).toBeUndefined();
        expect(result.commands).not.toContain('pnpm run package');
        expect(result.commands).toContain(`code-insiders --uninstall-extension ${localExtensionId}`);
        expect(result.commands.some((command) => command.startsWith('code-insiders --install-extension'))).toBe(true);
        expect(result.removed).toHaveLength(0);
    });

    it('replaces the Marketplace identity even when its version matches', async () => {
        const result = await runInstaller({ marketplaceVersion: packageInfo.version });

        expect(result.exitCode).toBeUndefined();
        const installIndex = result.commands.findIndex((command) => command.includes('--install-extension'));
        const uninstallIndex = result.commands.indexOf(`code --uninstall-extension ${extensionId}`);
        expect(installIndex).toBeGreaterThan(-1);
        expect(uninstallIndex).toBeGreaterThan(installIndex);
    });

    it('keeps the Marketplace copy when installation fails', async () => {
        const result = await runInstaller({ marketplaceVersion: '0.0.1', failedCommand: '--install-extension' });

        expect(result.exitCode).toBe(1);
        expect(result.commands).not.toContain(`code --uninstall-extension ${extensionId}`);
    });

    it('stops before installation or removal when packaging fails', async () => {
        const result = await runInstaller({ failedCommand: 'package', marketplaceVersion: '0.0.1' });

        expect(result.exitCode).toBe(1);
        expect(result.commands.some((command) => command.includes('--install-extension'))).toBe(false);
        expect(result.commands.some((command) => command.includes('--uninstall-extension'))).toBe(false);
        expect(result.removed).toHaveLength(0);
    });
});
