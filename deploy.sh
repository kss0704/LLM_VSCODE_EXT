#!/bin/bash

# LLM Code Assistant VS Code Extension Deployment Script
# This script handles the complete setup, build, test, and deployment process

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 16+ from https://nodejs.org/"
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm."
        exit 1
    fi
    
    if ! command -v code &> /dev/null; then
        print_warning "VS Code CLI is not installed. Install it for better development experience."
    fi
    
    # Check Node.js version
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 16 ]; then
        print_error "Node.js version 16+ is required. Current version: $(node -v)"
        exit 1
    fi
    
    print_success "Prerequisites check passed!"
}

# Initialize project structure
init_project() {
    print_status "Initializing project structure..."
    
    PROJECT_NAME="llm-code-assistant"
    
    if [ -d "$PROJECT_NAME" ]; then
        print_warning "Project directory already exists. Continuing..."
        cd "$PROJECT_NAME"
    else
        mkdir "$PROJECT_NAME"
        cd "$PROJECT_NAME"
        print_success "Created project directory: $PROJECT_NAME"
    fi
    
    # Create directory structure
    mkdir -p src .vscode out
    
    print_success "Project structure initialized!"
}

# Install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    
    # Initialize package.json if it doesn't exist
    if [ ! -f "package.json" ]; then
        npm init -y
    fi
    
    # Install development dependencies
    print_status "Installing development dependencies..."
    npm install --save-dev @types/vscode@^1.74.0 @types/node@16.x typescript@^4.9.4
    
    # Install production dependencies
    print_status "Installing production dependencies..."
    npm install axios@^1.6.0 sqlite3@^5.1.6 tiktoken@^1.0.10
    
    # Update package.json scripts
    npm pkg set scripts.vscode:prepublish="npm run compile"
    npm pkg set scripts.compile="tsc -p ./"
    npm pkg set scripts.watch="tsc -watch -p ./"
    npm pkg set scripts.test="npm run compile && node ./out/test/runTest.js"
    npm pkg set scripts.package="vsce package"
    npm pkg set scripts.publish="vsce publish"
    
    print_success "Dependencies installed successfully!"
}

# Set up TypeScript compilation
setup_typescript() {
    print_status "Setting up TypeScript compilation..."
    
    if [ ! -f "tsconfig.json" ]; then
        print_warning "tsconfig.json not found. Please ensure you have copied all configuration files."
    fi
    
    # Compile TypeScript
    print_status "Compiling TypeScript..."
    npx tsc -p ./
    
    if [ $? -eq 0 ]; then
        print_success "TypeScript compilation successful!"
    else
        print_error "TypeScript compilation failed!"
        exit 1
    fi
}

# Validate extension files
validate_extension() {
    print_status "Validating extension files..."
    
    # Check required files
    required_files=("package.json" "src/extension.ts" "src/codebaseHandler.ts" "src/llmService.ts" "src/chatViewProvider.ts")
    
    for file in "${required_files[@]}"; do
        if [ ! -f "$file" ]; then
            print_error "Required file missing: $file"
            exit 1
        fi
    done
    
    # Check compiled output
    if [ ! -f "out/extension.js" ]; then
        print_error "Compiled extension.js not found. Compilation may have failed."
        exit 1
    fi
    
    print_success "Extension files validation passed!"
}

# Install vsce if not present
install_vsce() {
    if ! command -v vsce &> /dev/null; then
        print_status "Installing vsce (Visual Studio Code Extension manager)..."
        npm install -g vsce
        print_success "vsce installed successfully!"
    else
        print_status "vsce is already installed."
    fi
}

# Package extension
package_extension() {
    print_status "Packaging extension..."
    
    install_vsce
    
    # Package the extension
    vsce package
    
    if [ $? -eq 0 ]; then
        VSIX_FILE=$(ls *.vsix | head -n 1)
        print_success "Extension packaged successfully: $VSIX_FILE"
        
        # Show package info
        print_status "Package information:"
        ls -lh *.vsix
    else
        print_error "Extension packaging failed!"
        exit 1
    fi
}

# Test extension
test_extension() {
    print_status "Testing extension..."
    
    if [ -f "out/test/runTest.js" ]; then
        npm run test
    else
        print_warning "No tests found. Skipping test execution."
        print_status "To test manually:"
        print_status "1. Open VS Code in this directory: code ."
        print_status "2. Press F5 to launch Extension Development Host"
        print_status "3. Test the extension functionality"
    fi
}

# Install extension locally
install_locally() {
    print_status "Installing extension locally for testing..."
    
    VSIX_FILE=$(ls *.vsix | head -n 1)
    if [ -f "$VSIX_FILE" ]; then
        if command -v code &> /dev/null; then
            code --install-extension "$VSIX_FILE"
            print_success "Extension installed locally!"
            print_status "Restart VS Code to see the extension."
        else
            print_warning "VS Code CLI not available. Install manually:"
            print_status "1. Open VS Code"
            print_status "2. Go to Extensions view (Ctrl+Shift+X)"
            print_status "3. Click '...' menu → Install from VSIX"
            print_status "4. Select: $(pwd)/$VSIX_FILE"
        fi
    else
        print_error "No VSIX file found. Package the extension first."
        exit 1
    fi
}

# Publish to marketplace (requires setup)
publish_extension() {
    print_status "Publishing to VS Code Marketplace..."
    print_warning "This requires a publisher account and personal access token."
    print_status "Visit: https://marketplace.visualstudio.com/manage"
    
    read -p "Do you have a publisher account set up? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        vsce publish
        if [ $? -eq 0 ]; then
            print_success "Extension published successfully!"
        else
            print_error "Publishing failed. Check your credentials and publisher setup."
        fi
    else
        print_status "To publish later:"
        print_status "1. Create publisher account at https://marketplace.visualstudio.com/manage"
        print_status "2. Generate Personal Access Token"
        print_status "3. Run: vsce login <publisher-name>"
        print_status "4. Run: vsce publish"
    fi
}

# Clean build artifacts
clean() {
    print_status "Cleaning build artifacts..."
    rm -rf out/
    rm -f *.vsix
    print_success "Clean completed!"
}

# Main execution
main() {
    print_status "🚀 LLM Code Assistant Extension Deployment Script"
    print_status "================================================"
    
    case "${1:-all}" in
        "check")
            check_prerequisites
            ;;
        "init")
            check_prerequisites
            init_project
            ;;
        "install")
            install_dependencies
            ;;
        "compile")
            setup_typescript
            ;;
        "validate")
            validate_extension
            ;;
        "package")
            setup_typescript
            validate_extension
            package_extension
            ;;
        "test")
            test_extension
            ;;
        "install-local")
            install_locally
            ;;
        "publish")
            publish_extension
            ;;
        "clean")
            clean
            ;;
        "all")
            check_prerequisites
            install_dependencies
            setup_typescript
            validate_extension
            package_extension
            print_success "🎉 Extension ready for testing!"
            print_status ""
            print_status "Next steps:"
            print_status "1. Test locally: ./deploy.sh install-local"
            print_status "2. Open VS Code and test the extension"
            print_status "3. Configure your Groq API key in VS Code settings"
            print_status "4. Process a workspace and start chatting!"
            ;;
        *)
            echo "Usage: $0 {check|init|install|compile|validate|package|test|install-local|publish|clean|all}"
            echo ""
            echo "Commands:"
            echo "  check        - Check prerequisites"
            echo "  init         - Initialize project structure"
            echo "  install      - Install dependencies"
            echo "  compile      - Compile TypeScript"
            echo "  validate     - Validate extension files"
            echo "  package      - Package extension (.vsix)"
            echo "  test         - Run tests"
            echo "  install-local- Install extension locally"
            echo "  publish      - Publish to marketplace"
            echo "  clean        - Clean build artifacts"
            echo "  all          - Run full build pipeline (default)"
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
