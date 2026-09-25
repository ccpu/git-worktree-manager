/* eslint-disable @typescript-eslint/naming-convention -- VS Code manifest keys use fixed names. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';

interface MenuEntry {
    command?: string;
    group?: string;
    when?: string;
}

interface ExtensionManifest {
    contributes: {
        commands: { command: string }[];
        menus: { 'view/item/context': MenuEntry[] };
    };
    scripts: { 'install:local'?: string };
}

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as ExtensionManifest;

describe('fork extension contributions', () => {
    it('offers direct removal for a secondary worktree but hides it for the main worktree', () => {
        const command = 'git-worktree-manager.removeWorktree';
        const entries = manifest.contributes.menus['view/item/context'].filter((entry) => entry.command === command);
        const directEntry = entries.find((entry) => entry.group === 'worktree-delete');

        expect(manifest.contributes.commands.some((entry) => entry.command === command)).toBe(true);
        expect(directEntry).toBeDefined();
        expect(directEntry?.when).toContain('&& !(viewItem =~ /');

        const patterns = [...(directEntry?.when ?? '').matchAll(/viewItem =~ \/([^/]+)\//g)].map(
            (match) => new RegExp(match[1]),
        );
        expect(patterns).toHaveLength(2);
        expect(patterns[0].test('git-worktree-manager.worktreeItem.notBare.unlock.current')).toBe(true);
        expect(patterns[1].test('git-worktree-manager.worktreeItem.notBare.unlock.current')).toBe(false);
        expect(patterns[1].test('git-worktree-manager.worktreeItem.notBare.main.current')).toBe(true);
        expect(patterns[0].test('git-worktree-manager.gitFolderItem')).toBe(false);
    });

    it('keeps the local installer available from pnpm and out of the VSIX', () => {
        const ignored = readFileSync(join(root, '.vscodeignore'), 'utf8').split(/\r?\n/);

        expect(manifest.scripts['install:local']).toBe('node ./scripts/install-local.js');
        expect(ignored).toContain('scripts/**');
    });
});
