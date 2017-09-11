
export type Level = 'VERBOSE' | 'NORMAL';
enum LogLevelEnum
{
	VERBOSE,
	NORMAL
}

export var print:(message:string)=>void = ()=>{};

export var logLevel:LogLevelEnum = LogLevelEnum.NORMAL;

export function set(printFunc:(message:string)=>void):void
{
	print = printFunc;
}

export function setLogLevel(level:Level):void
{
	logLevel = LogLevelEnum[level];
	verbose(`logLevel = ${level}`);
}

export function log(level:LogLevelEnum, ...message:string[]):void
{
	if (level < logLevel) return;
	switch (logLevel)
	{
	case LogLevelEnum.VERBOSE:
		print(LogLevelEnum[level]+': '+message.join(' ').replace(/\n/g, '\nVERBOSE: '));
		break;
	default:
		print(message.join(' '));
		break;
	}
}

export function message(...message:string[]):void
{
	log(LogLevelEnum.NORMAL, ...message);
}

export function verbose(...message:string[]):void
{
	log(LogLevelEnum.VERBOSE, ... message);
}
