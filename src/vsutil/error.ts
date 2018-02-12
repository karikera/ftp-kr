
import { vsutil } from './vsutil';
import { Logger } from './log';

declare global
{
	interface Error
	{
		suppress?:boolean;
		task?:string;
	}
}

export function processError(logger:Logger, err:any):void
{
	if (err instanceof Error)
	{
		if (!err.suppress)
		{
			logger.error(err);
		}
		else
		{
			logger.show();
			logger.message(err.message);
		}
		if (err.file)
		{
			if (err.line)
			{
				vsutil.open(err.file, err.line, err.column);
			}
			else
			{
				vsutil.open(err.file);
			}
		}
	}
	else
	{
		logger.error(err);
	}
}
