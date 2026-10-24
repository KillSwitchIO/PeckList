import { createChronoDateParser } from './chrono-date-parser.ts';
import { describeDateParserContract } from './dateParser.contract.ts';

describeDateParserContract('chrono-node', createChronoDateParser());
