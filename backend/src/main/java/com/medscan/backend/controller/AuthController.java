package com.medscan.backend.controller;

import com.medscan.backend.model.User;
import com.medscan.backend.payload.request.LoginRequest;
import com.medscan.backend.payload.request.SignupRequest;
import com.medscan.backend.payload.response.JwtResponse;
import com.medscan.backend.payload.response.MessageResponse;
import com.medscan.backend.repository.mysql.UserRepository;
import com.medscan.backend.security.UserDetailsImpl;
import com.medscan.backend.security.jwt.JwtUtils;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@CrossOrigin(origins = "*", maxAge = 3600)
@RestController
@RequestMapping("/api/auth")
public class AuthController {
    @Autowired
    AuthenticationManager authenticationManager;

    @Autowired
    UserRepository userRepository;

    @Autowired
    PasswordEncoder encoder;

    @Autowired
    JwtUtils jwtUtils;

    @PostMapping("/signin")
    public ResponseEntity<?> authenticateUser(@Valid @RequestBody LoginRequest loginRequest) {
        System.out.println("Login Request: " + loginRequest);
        Authentication authentication = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(loginRequest.getUsername(), loginRequest.getPassword()));

        SecurityContextHolder.getContext().setAuthentication(authentication);
        UserDetailsImpl userDetails = (UserDetailsImpl) authentication.getPrincipal();
        String jwt = jwtUtils.generateJwtToken(userDetails);

        List<String> roles = userDetails.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(Collectors.toList());

        return ResponseEntity.ok(new JwtResponse(jwt,
                userDetails.getId(),
                userDetails.getUsername(),
                userDetails.getEmail(),
                userDetails.getFullName(),
                userDetails.getPhoneNumber(),
                roles));
    }

    @PostMapping("/signup")
    public ResponseEntity<?> registerUser(@Valid @RequestBody SignupRequest signUpRequest) {
        if (userRepository.existsByUsername(signUpRequest.getUsername())) {
            return ResponseEntity
                    .badRequest()
                    .body(new MessageResponse("Error: Username is already taken!"));
        }

        if (userRepository.existsByEmail(signUpRequest.getEmail())) {
            return ResponseEntity
                    .badRequest()
                    .body(new MessageResponse("Error: Email is already in use!"));
        }

        if (userRepository.existsByPhoneNumber(signUpRequest.getPhoneNumber())) {
            return ResponseEntity
                    .badRequest()
                    .body(new MessageResponse("Error: Phone number is already registered!"));
        }

        // Create new user's account
        User user = new User();
        user.setUsername(signUpRequest.getUsername());
        user.setEmail(signUpRequest.getEmail());
        user.setPassword(encoder.encode(signUpRequest.getPassword()));
        user.setFullName(signUpRequest.getFullName());
        user.setPhoneNumber(signUpRequest.getPhoneNumber());

        // Default role based on request or default to PATIENT
        String strRole = signUpRequest.getRole();
        if (strRole == null) {
            user.setRole(User.Role.PATIENT);
        } else {
            try {
                user.setRole(User.Role.valueOf(strRole.toUpperCase()));
            } catch (IllegalArgumentException e) {
                user.setRole(User.Role.PATIENT);
            }
        }

        userRepository.save(user);

        return ResponseEntity.ok(new MessageResponse("User registered successfully!"));
    }

    @GetMapping("/validate")
    public ResponseEntity<?> validateToken() {
        // If this endpoint is reached, the JWT token in the request is valid
        // (AuthTokenFilter already validated it).
        return ResponseEntity.ok(Map.of("valid", true));
    }

    @PostMapping("/refresh")
    public ResponseEntity<?> refreshToken() {
        // Re-issue a fresh token for the currently authenticated user
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            return ResponseEntity.status(401).body(new MessageResponse("Not authenticated"));
        }
        UserDetailsImpl userDetails = (UserDetailsImpl) auth.getPrincipal();
        String newJwt = jwtUtils.generateJwtToken(userDetails);
        List<String> roles = userDetails.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(Collectors.toList());
        return ResponseEntity.ok(new JwtResponse(newJwt,
                userDetails.getId(),
                userDetails.getUsername(),
                userDetails.getEmail(),
                userDetails.getFullName(),
                userDetails.getPhoneNumber(),
                roles));
    }

    @PutMapping("/profile")
    public ResponseEntity<?> updateProfile(@RequestBody Map<String, String> updates) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            return ResponseEntity.status(401).body(new MessageResponse("Not authenticated"));
        }
        UserDetailsImpl userDetails = (UserDetailsImpl) auth.getPrincipal();
        User user = userRepository.findById(userDetails.getId()).orElse(null);
        if (user == null) {
            return ResponseEntity.notFound().build();
        }
        if (updates.containsKey("fullName")) user.setFullName(updates.get("fullName"));
        if (updates.containsKey("email")) user.setEmail(updates.get("email"));
        if (updates.containsKey("phoneNumber")) user.setPhoneNumber(updates.get("phoneNumber"));
        if (updates.containsKey("username")) {
            String newUsername = updates.get("username");
            if (newUsername != null && !newUsername.equals(user.getUsername())) {
                if (userRepository.existsByUsername(newUsername)) {
                    return ResponseEntity.badRequest().body(new MessageResponse("Username is already taken!"));
                }
                user.setUsername(newUsername);
            }
        }
        userRepository.save(user);
        return ResponseEntity.ok(Map.of(
            "id", user.getId(),
            "username", user.getUsername() != null ? user.getUsername() : "",
            "fullName", user.getFullName() != null ? user.getFullName() : "",
            "email", user.getEmail() != null ? user.getEmail() : "",
            "phoneNumber", user.getPhoneNumber() != null ? user.getPhoneNumber() : ""
        ));
    }

    @GetMapping("/search")
    public ResponseEntity<?> searchUsers(@RequestParam String query) {
        if (query == null || query.length() < 2) {
            return ResponseEntity.ok(List.of());
        }
        List<User> users = userRepository
                .findTop10ByUsernameContainingIgnoreCaseOrFullNameContainingIgnoreCaseOrEmailContainingIgnoreCase(
                        query, query, query);
        // Return safe projections (without password)
        List<Map<String, Object>> results = users.stream().map(u -> Map.<String, Object>of(
                "id", u.getId(),
                "username", u.getUsername() != null ? u.getUsername() : "",
                "fullName", u.getFullName() != null ? u.getFullName() : "",
                "email", u.getEmail() != null ? u.getEmail() : ""
        )).collect(Collectors.toList());
        return ResponseEntity.ok(results);
    }
}
