"""Native lifecycle source contract; real Android document-provider UI needs phone QA."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
class NativePickerContract(unittest.TestCase):
    def test_callback_is_bound_to_current_webview_and_unique_request(self):
        source=(ROOT/'android/app/src/main/java/app/nightcity/crew/MainActivity.java').read_text()
        chooser=source.split('@Override public boolean onShowFileChooser',1)[1].split('@Override public void onPermissionRequest',1)[0]
        self.assertIn('if (view != webView)',chooser)
        self.assertIn('activeFileRequest = PICK_FILE + (++pickerSerial % 60000)',chooser)
        self.assertIn('FilePickerMime.normalize(params.getAcceptTypes())',chooser)
        result=source.split('requestCode >= PICK_FILE',1)[1].split('requestCode == SAVE_FILE',1)[0]
        self.assertIn('requestCode != activeFileRequest',result)
        self.assertIn('uploadOwner != webView',result)
        self.assertLess(result.index('uploadCallback = null'),result.index('callback.onReceiveValue(selected)'))
        destroy=source.split('private void destroyWebView()',1)[1].split('\n    }',1)[0]
        self.assertLess(destroy.index('cancelFilePicker()'),destroy.index('webView.destroy()'))
