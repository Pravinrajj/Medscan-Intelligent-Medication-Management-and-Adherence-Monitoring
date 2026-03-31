package com.medscan.backend.security;

import com.medscan.backend.model.User;
import com.medscan.backend.repository.mysql.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

@Service
public class UserDetailsServiceImpl implements UserDetailsService {
    
    @Autowired
    UserRepository userRepository;

    /**
     * Flexible login: tries username, then email, then phone number.
     * This allows users to log in with whichever identifier they remember.
     */
    @Override
    @Transactional
    public UserDetails loadUserByUsername(String identifier) throws UsernameNotFoundException {
        // Try username first
        Optional<User> user = userRepository.findByUsername(identifier);
        
        // Try email
        if (user.isEmpty()) {
            user = userRepository.findByEmail(identifier);
        }
        
        // Try phone number
        if (user.isEmpty()) {
            user = userRepository.findByPhoneNumber(identifier);
        }

        return UserDetailsImpl.build(
            user.orElseThrow(() -> new UsernameNotFoundException(
                "No account found with username, email, or phone: " + identifier))
        );
    }
}
