# Backend boundary

Provider-neutral contracts belong here. Provider implementations must remain in named subdirectories and must not be imported by the main package entry point.

The embedding host owns authentication, cookies, token refresh, route protection and authoritative claim validation. Core Figcraft code receives identity, session status and capabilities through a provider-neutral adapter without Supabase types. Client-visible roles may control presentation, but backend claims and policies remain the authority.
