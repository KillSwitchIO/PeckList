import { icuMessageFormat } from './icu-message-format.ts';
import { describeMessageFormatContract } from './messageFormat.contract.ts';
import { plainMessageFormat } from './plain-message-format.ts';

describeMessageFormatContract('intl-messageformat', icuMessageFormat, { icu: true });
describeMessageFormatContract('plain', plainMessageFormat, { icu: false });
