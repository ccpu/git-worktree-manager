import * as vscode from 'vscode';
import { GlobalState } from '@/core/state';

// Open the walkthrough belonging to the installed extension identity.
export const openWalkthroughsCmd = () => {
    vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        `${GlobalState.context.extension.id}#git-worktree-usage`,
        false,
    );
};
