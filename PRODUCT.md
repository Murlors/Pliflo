# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Tauri 2 desktop application with React, TypeScript and Vite+. macOS is the complete first-release target; the architecture keeps room for a Windows print backend later. All files stay local and there is no server.

## Primary Users

People who repeatedly print groups of PDF documents from a desktop Mac and need more control and visibility than the system print dialog provides.

## Core Job

Import a batch of PDFs, put them in the intended order, inspect the documents, choose batch defaults or per-file overrides, submit each document as an independent print job, and understand whether each job is merely submitted to the operating system or has actually completed.

## Operating Context

The product is a focused desktop utility used during routine document handling. Typical work happens with a printer already configured in macOS, several local PDFs, and a need to prepare or monitor many jobs without repeatedly reopening native dialogs.

## Capabilities and Constraints

- Batch import through file picker and drag and drop.
- Reorder, search, inspect metadata and preview PDFs locally.
- Batch defaults plus per-file print settings.
- Printer discovery, presets, queue management, cancellation, history and explicit error states.
- Every PDF is submitted as its own system print job by default.
- macOS printing uses the local CUPS command-line interface to keep runtime size and maintenance cost low.
- System submission and physical completion are separate states in the product model.
- Real printing must never be triggered during development or automated verification without the user’s explicit confirmation.
- Device-specific options are limited by the actual printer and driver capabilities available on the host.
- Small package size, low maintenance cost, fast startup and local-only processing are durable product constraints.

## Brand Commitments

The product name is Pliflo. The interface uses Lucide icons and never uses emoji. The user wants a distinctive, premium desktop-tool identity with the craft level associated with Awwwards and FWA work, while preserving speed, readability and day-to-day operational efficiency.

## Evidence on Hand

The current repository contains a working macOS-first implementation with PDF import, preview, settings, queue states, printer discovery and Tauri packaging. There are no customer testimonials, benchmark claims or external brand assets to fabricate.

## Product Principles

- Make batch printing feel calm, legible and controlled even when many files are involved.
- Show operational truth precisely, especially the difference between job submission and physical completion.
- Keep the app lightweight by using mature platform capabilities instead of large runtime dependencies.
- Make frequent actions fast while keeping exceptions and per-file overrides easy to reach.
- Use visual character to make the tool memorable without reducing scanability or increasing friction.
