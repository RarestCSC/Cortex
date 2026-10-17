import { useState, useEffect } from 'react';
import { Button } from '../../ui/button';
import { Check } from '../../icons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { errorMessage } from '../../../utils/conversionUtils';
import { defineMessages, useIntl } from '../../../i18n';

const i18n = defineMessages({
  dialogTitle: {
    id: 'hintsModal.dialogTitle',
    defaultMessage: 'Configure Project Hints (.hints)',
  },
  dialogDescription: {
    id: 'hintsModal.dialogDescription',
    defaultMessage:
      'Provide additional context about your project to improve communication with Cortex',
  },
  helpText1: {
    id: 'hintsModal.helpText1',
    defaultMessage:
      '.hints is a text file used to provide additional context about your project and improve the communication with Cortex.',
  },
  helpText2: {
    id: 'hintsModal.helpText2',
    defaultMessage:
      "Please make sure {bold} extension is enabled in the extensions page. This extension is required to use .hints. You'll need to restart your session for .hints updates to take effect.",
  },
  helpText3: {
    id: 'hintsModal.helpText3',
    defaultMessage: 'See {link} for more information.',
  },
  helpTextLink: {
    id: 'hintsModal.helpTextLink',
    defaultMessage: 'using .hints',
  },
  errorReading: {
    id: 'hintsModal.errorReading',
    defaultMessage: 'Error reading .hints file: {error}',
  },
  fileFound: {
    id: 'hintsModal.fileFound',
    defaultMessage: '.hints file found at: {filePath}',
  },
  fileCreating: {
    id: 'hintsModal.fileCreating',
    defaultMessage: 'Creating new .hints file at: {filePath}',
  },
  placeholder: {
    id: 'hintsModal.placeholder',
    defaultMessage: 'Enter project hints here...',
  },
  savedSuccessfully: {
    id: 'hintsModal.savedSuccessfully',
    defaultMessage: 'Saved successfully',
  },
  close: {
    id: 'hintsModal.close',
    defaultMessage: 'Close',
  },
  saving: {
    id: 'hintsModal.saving',
    defaultMessage: 'Saving...',
  },
  save: {
    id: 'hintsModal.save',
    defaultMessage: 'Save',
  },
  failedToAccess: {
    id: 'hintsModal.failedToAccess',
    defaultMessage: 'Failed to access .hints file',
  },
  failedToSave: {
    id: 'hintsModal.failedToSave',
    defaultMessage: 'Failed to save .hints file',
  },
  developer: {
    id: 'hintsModal.developer',
    defaultMessage: 'Developer',
  },
});

const HelpText = () => {
  const intl = useIntl();

  return (
    <div className="text-sm flex-col space-y-4 text-text-secondary">
      <p>{intl.formatMessage(i18n.helpText1)}</p>
      <p>
        {intl.formatMessage(i18n.helpText2, {
          bold: <span className="font-bold">{intl.formatMessage(i18n.developer)}</span>,
        })}
      </p>
    </div>
  );
};

const ErrorDisplay = ({ error }: { error: Error }) => {
  const intl = useIntl();

  return (
    <div className="text-sm text-text-secondary">
      <div className="text-red-600">
        {intl.formatMessage(i18n.errorReading, { error: errorMessage(error) })}
      </div>
    </div>
  );
};

const FileInfo = ({ filePath, found }: { filePath: string; found: boolean }) => {
  const intl = useIntl();

  return (
    <div className="text-sm font-medium mb-2">
      {found ? (
        <div className="text-green-600">
          <Check className="w-4 h-4 inline-block" />{' '}
          {intl.formatMessage(i18n.fileFound, { filePath })}
        </div>
      ) : (
        <div>{intl.formatMessage(i18n.fileCreating, { filePath })}</div>
      )}
    </div>
  );
};

interface HintsModalProps {
  directory: string;
  setIsHintsModalOpen: (isOpen: boolean) => void;
}

export const HintsModal = ({ directory, setIsHintsModalOpen }: HintsModalProps) => {
  const intl = useIntl();
  const hintsFilePath = `${directory}/.hints`;
  const [hintsFile, setHintsFile] = useState<string>('');
  const [hintsFileFound, setHintsFileFound] = useState<boolean>(false);
  const [hintsFileReadError, setHintsFileReadError] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    const fetchHintsFile = async () => {
      try {
        const { file, error, found } = await window.electron.readHints();
        setHintsFile(file);
        setHintsFileFound(found);
        setHintsFileReadError(error ?? '');
      } catch (error) {
        console.error('Error fetching .hints file:', error);
        setHintsFileReadError(intl.formatMessage(i18n.failedToAccess));
      }
    };
    if (directory) fetchHintsFile();
  }, [directory, intl]);

  const writeFile = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const saved = await window.electron.writeHints(hintsFile);
      if (!saved) {
        throw new Error('Unable to save .hints');
      }
      setSaveSuccess(true);
      setHintsFileFound(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error writing .hints file:', error);
      setHintsFileReadError(intl.formatMessage(i18n.failedToSave));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => setIsHintsModalOpen(open)}>
      <DialogContent className="w-[80vw] max-w-[80vw] sm:max-w-[80vw] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage(i18n.dialogTitle)}</DialogTitle>
          <DialogDescription>{intl.formatMessage(i18n.dialogDescription)}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pt-2 pb-4">
          <HelpText />

          <div>
            {hintsFileReadError ? (
              <ErrorDisplay error={new Error(hintsFileReadError)} />
            ) : (
              <div className="space-y-2">
                <FileInfo filePath={hintsFilePath} found={hintsFileFound} />
                <textarea
                  value={hintsFile}
                  className="w-full h-80 border rounded-md p-2 text-sm resize-none bg-background-primary text-text-primary border-border-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onChange={(event) => setHintsFile(event.target.value)}
                  placeholder={intl.formatMessage(i18n.placeholder)}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          {saveSuccess && (
            <span className="text-green-600 text-sm flex items-center gap-1 mr-auto">
              <Check className="w-4 h-4" />
              {intl.formatMessage(i18n.savedSuccessfully)}
            </span>
          )}
          <Button variant="outline" onClick={() => setIsHintsModalOpen(false)}>
            {intl.formatMessage(i18n.close)}
          </Button>
          <Button onClick={writeFile} disabled={isSaving}>
            {isSaving ? intl.formatMessage(i18n.saving) : intl.formatMessage(i18n.save)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
