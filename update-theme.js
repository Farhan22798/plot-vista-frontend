const fs = require('fs');
const path = require('path');

function updateFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');

  // Skip if already processed
  if (!content.includes('useTheme')) {
    // 1. Add Imports
    if(content.includes("import { useAlert }")) {
      content = content.replace(/import { useAlert } from '\.\.\/context\/AlertContext';/, 
        "import { useAlert } from '../context/AlertContext';\nimport { useTheme } from '../context/ThemeContext';");
    } else if (content.includes("import { AuthContext }")) {
      content = content.replace(/import { AuthContext } from '\.\.\/context\/AuthContext';/, 
        "import { AuthContext } from '../context/AuthContext';\nimport { useTheme } from '../context/ThemeContext';");
    } else {
      content = content.replace(/import React/, "import { useTheme } from '../context/ThemeContext';\nimport React");
    }

    // 2. Inject useTheme inside component body
    const componentRegex = /const ([a-zA-Z]+Screen|[a-zA-Z]+Modal) = \((.*?)\) => \{/;
    content = content.replace(componentRegex, (match, p1, p2) => {
      return `const ${p1} = (${p2}) => {\n  const { isDark, colors } = useTheme();\n  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);`;
    });
  }

  // 3. Convert StyleSheet to dynamic getStyles
  if (!content.includes('const getStyles')) {
    content = content.replace(/const styles = StyleSheet.create\(\{/, 'const getStyles = (colors, isDark) => StyleSheet.create({');
    
    // Replace heavily hardcoded colors
    content = content.replace(/'#fff'/gi, 'colors.surface');
    content = content.replace(/'#ffffff'/gi, 'colors.surface');
    content = content.replace(/'#f5f5f5'/gi, 'colors.background');
    content = content.replace(/'white'/gi, 'colors.surface');
    
    content = content.replace(/'#333'/gi, 'colors.text');
    content = content.replace(/'#000'/gi, 'colors.text');
    content = content.replace(/'#555'/gi, 'colors.textSecondary');
    content = content.replace(/'#666'/gi, 'colors.textSecondary');
    content = content.replace(/'#444'/gi, 'colors.textSecondary');
    content = content.replace(/'black'/gi, 'colors.text');
    
    content = content.replace(/'#ddd'/gi, 'colors.border');
    content = content.replace(/'#ccc'/gi, 'colors.border');
    content = content.replace(/'#eee'/gi, 'colors.border');
    
    // Replace text inputs placeholderTextColor
    content = content.replace(/placeholderTextColor="#888"/gi, 'placeholderTextColor={colors.placeholder}');
    content = content.replace(/placeholderTextColor='#888'/gi, 'placeholderTextColor={colors.placeholder}');
    
    // Add explicit placeholder to naked TextInputs
    content = content.replace(/<TextInput(?![\s\S]*?placeholderTextColor={colors.placeholder})/g, '<TextInput placeholderTextColor={colors.placeholder}');
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Processed', filePath);
}

const screens = [
  'LayoutScreen.js', 
  'SummaryScreen.js', 
  'ProfileScreen.js', 
  'AreaStatementScreen.js', 
  'LoginScreen.js', 
  'SignupScreen.js', 
  'PendingApprovalScreen.js',
];

screens.forEach(s => updateFile(path.join(__dirname, 'src/screens', s)));
updateFile(path.join(__dirname, 'src/components/BookingModal.js'));
