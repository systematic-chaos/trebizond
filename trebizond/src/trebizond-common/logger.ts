import { createLogger, format, transports } from 'winston';

const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.colorize({ all: true }),
        format.timestamp({
            format: 'YYYY/MM/DD hh:mm:ss'
        }),
        format.json(),
        format.printf((info) => `${info.timestamp} # ${info.level} :\t${info.message}`)
    ),
    transports: [
        new transports.Console()
    ]
});

export { logger as log };
