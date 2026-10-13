import * as vscode from 'vscode';
import { GlobalState } from '@/core/state';

// Open settings for the installed extension identity, including local builds.
export function openSettingCmd() {
    void vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${GlobalState.context.extension.id}`);
}
