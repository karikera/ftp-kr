
export type FileType = ''|'-'|'d'|'l';

export class FileInfo
{
	type:FileType = '';
	name:string = '';
	size:number = 0;
	date:number = 0;
	link:string|undefined;
}
