import * as vscode from "vscode";

export class ContributorsTreeView implements vscode.TreeDataProvider<User>{
    
    getUsers: Function;
    constructor(getUsers){
        this.getUsers=getUsers;
        this.refresh=this.refresh.bind(this);
    }
    
    private _onDidChangeTreeData: vscode.EventEmitter<User | undefined> = new vscode.EventEmitter<User | undefined>();
    readonly onDidChangeTreeData: vscode.Event<User | undefined> = this._onDidChangeTreeData.event;
    
    refresh(): void {
		this._onDidChangeTreeData.fire();
	}
    
    getTreeItem(element: User): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: User): import("vscode").ProviderResult<User[]> {       
        return Promise.resolve(this.getUsers());
    }
    getParent?(element: User): import("vscode").ProviderResult<User> {
        throw new Error("Method not implemented.");
    }


}

export class User extends vscode.TreeItem{
    constructor(name:string, siteId:Number){
        super(name, vscode.TreeItemCollapsibleState.None);
        this.command={
            command:'stageChanges',
            arguments:[siteId],
            title:'Stage Changes'
        }
    }

}