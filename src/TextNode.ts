class TextNode{
    static current_client_pun=1;
    pid: Number;
    pun: number;
    str: String;
    offset: Number;
    l: TextNode;
    r: TextNode;
    il: TextNode;
    ir: TextNode;
    depl: TextNode;
    depr: TextNode;
    dels: TextNode[];
    undo: TextNode;
    
    constructor({pid,pun=TextNode.current_client_pun++, str, offset, l, r, il, ir, depl, depr, dels, undo}){
        this.pid=pid;
        this.pun = pun;
        this.str=str;
        this.offset=offset;
        this.l=l;
        this.r=r;
        this.il=il;
        this.ir=ir;
        this.depl=depl;
        this.depr=depr;
        this.dels=dels;
        this.undo=undo;
    }
}


module.exports = TextNode;