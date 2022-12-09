export type FileType = '' | '-' | 'd' | 'l';

export class FileInfo {
	type: FileType = '';
	name = '';
	size = 0;
	date = 0;
	link: string | undefined;
}
